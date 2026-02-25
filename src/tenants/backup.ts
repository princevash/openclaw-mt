/**
 * Tenant backup and restore functionality.
 * OPENCLAWMU ADDITION: multi-tenant S3 backup/restore.
 *
 * Supports S3-compatible storage for tenant data archival.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { TenantId } from "./types.js";
import { resolveTenantStateDir } from "./paths.js";
import { getTenant, createTenant } from "./registry.js";

export type BackupConfig = {
  /** S3 endpoint (for S3-compatible services like MinIO). */
  endpoint?: string;
  /** AWS region. */
  region?: string;
  /** S3 bucket name. */
  bucket: string;
  /** Key prefix for backups. */
  prefix?: string;
  /** AWS access key ID (or use environment). */
  accessKeyId?: string;
  /** AWS secret access key (or use environment). */
  secretAccessKey?: string;
  /** Force path-style URLs (for MinIO). */
  forcePathStyle?: boolean;
};

export type BackupInfo = {
  key: string;
  size: number;
  lastModified: string;
  tenantId: string;
  timestamp: string;
};

export type BackupResult = {
  key: string;
  tenantId: string;
  timestamp: string;
  size: number;
};

export type RestoreResult = {
  tenantId: string;
  restoredAt: string;
  sourceKey: string;
};

/**
 * Creates an S3 client with the provided configuration.
 */
async function createS3Client(config: BackupConfig) {
  const { S3Client } = await import("@aws-sdk/client-s3");

  return new S3Client({
    endpoint: config.endpoint,
    region: config.region ?? "us-east-1",
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
    forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
  });
}

/**
 * Creates a tar.gz archive of a directory.
 */
async function createTarGz(sourceDir: string, outputPath: string): Promise<void> {
  await tar.create(
    {
      gzip: true,
      file: outputPath,
      cwd: sourceDir,
      portable: true,
    },
    ["."],
  );
}

/**
 * Extracts a tar.gz archive to a directory.
 * Includes security measures to prevent symlink/path traversal attacks.
 */
async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });

  // Resolve the absolute target directory for security checks
  const resolvedTargetDir = path.resolve(targetDir);

  await tar.extract({
    file: archivePath,
    cwd: targetDir,
    strip: 0,
    // Security: reject absolute paths in archive
    preservePaths: false,
    // Security: don't change file permissions
    noChmod: true,
    // Security: don't preserve mtime (reduces attack surface)
    noMtime: true,
    // Security: filter out dangerous entries
    filter: (entryPath, entry) => {
      // Cast entry to ReadEntry to access type and linkpath
      const readEntry = entry as tar.ReadEntry;
      // Reject symlinks that could point outside the target directory
      if (readEntry.type === "SymbolicLink" || readEntry.type === "Link") {
        const linkTarget = readEntry.linkpath ?? "";
        // Resolve the symlink target relative to the entry's parent directory
        const entryDir = path.dirname(path.join(resolvedTargetDir, entryPath));
        const resolvedLink = path.resolve(entryDir, linkTarget);
        // Reject if the link points outside the target directory
        if (
          !resolvedLink.startsWith(resolvedTargetDir + path.sep) &&
          resolvedLink !== resolvedTargetDir
        ) {
          return false;
        }
      }
      // Reject paths that try to escape (should be caught by preservePaths: false, but defense in depth)
      const resolvedEntry = path.resolve(resolvedTargetDir, entryPath);
      if (
        !resolvedEntry.startsWith(resolvedTargetDir + path.sep) &&
        resolvedEntry !== resolvedTargetDir
      ) {
        return false;
      }
      return true;
    },
  });
}

/**
 * Backs up a tenant's data to S3.
 */
export async function backupTenantToS3(params: {
  tenantId: TenantId;
  config: BackupConfig;
  key?: string;
}): Promise<BackupResult> {
  const { tenantId, config } = params;
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");

  // Verify tenant exists
  const tenant = getTenant(tenantId);
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const stateDir = resolveTenantStateDir(tenantId);

  // Check if state directory exists
  try {
    await fs.access(stateDir);
  } catch {
    throw new Error(`Tenant state directory not found: ${stateDir}`);
  }

  // Create temp archive
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveName = `${tenantId}-${timestamp}.tar.gz`;
  const archivePath = path.join(os.tmpdir(), archiveName);

  try {
    // Create tar.gz archive
    await createTarGz(stateDir, archivePath);

    // Read archive
    const archiveData = await fs.readFile(archivePath);

    // Determine S3 key
    const prefix = config.prefix ?? "backups";
    const key = params.key ?? `${prefix}/${tenantId}/${archiveName}`;

    // Upload to S3
    const s3 = await createS3Client(config);
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: archiveData,
        ContentType: "application/gzip",
        Metadata: {
          tenantId,
          timestamp,
          version: "1",
        },
      }),
    );

    return {
      key,
      tenantId,
      timestamp,
      size: archiveData.length,
    };
  } finally {
    // Cleanup temp file
    try {
      await fs.unlink(archivePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Restores a tenant from an S3 backup.
 */
export async function restoreTenantFromS3(params: {
  tenantId: TenantId;
  config: BackupConfig;
  key: string;
  createIfMissing?: boolean;
}): Promise<RestoreResult> {
  const { tenantId, config, key, createIfMissing = true } = params;
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");

  // Check if tenant exists
  let tenant = getTenant(tenantId);
  if (!tenant && createIfMissing) {
    // Create tenant if it doesn't exist
    const result = createTenant(tenantId);
    tenant = getTenant(result.tenantId);
  }

  if (!tenant) {
    throw new Error(`Tenant not found and createIfMissing is false: ${tenantId}`);
  }

  const stateDir = resolveTenantStateDir(tenantId);

  // Create temp file for download
  const archivePath = path.join(os.tmpdir(), `restore-${tenantId}-${Date.now()}.tar.gz`);

  try {
    // Download from S3
    const s3 = await createS3Client(config);
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error("Empty response body from S3");
    }

    // Write to temp file
    const bodyBytes = await response.Body.transformToByteArray();
    await fs.writeFile(archivePath, bodyBytes);

    // Clear existing state directory (but keep it if empty)
    try {
      const entries = await fs.readdir(stateDir);
      for (const entry of entries) {
        await fs.rm(path.join(stateDir, entry), { recursive: true, force: true });
      }
    } catch {
      // Directory might not exist
    }

    // Ensure directory exists
    await fs.mkdir(stateDir, { recursive: true });

    // Extract archive
    await extractTarGz(archivePath, stateDir);

    return {
      tenantId,
      restoredAt: new Date().toISOString(),
      sourceKey: key,
    };
  } finally {
    // Cleanup temp file
    try {
      await fs.unlink(archivePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Lists backups for a tenant in S3.
 */
export async function listTenantBackups(params: {
  tenantId: TenantId;
  config: BackupConfig;
}): Promise<BackupInfo[]> {
  const { tenantId, config } = params;
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");

  const prefix = config.prefix ?? "backups";
  const searchPrefix = `${prefix}/${tenantId}/`;

  const s3 = await createS3Client(config);
  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: searchPrefix,
    }),
  );

  const backups: BackupInfo[] = [];

  for (const obj of response.Contents ?? []) {
    if (!obj.Key) {
      continue;
    }

    // Parse timestamp from key
    const fileName = path.basename(obj.Key);
    const match = fileName.match(/^(.+)-(\d{4}-\d{2}-\d{2}T.+)\.tar\.gz$/);
    const timestamp = match ? match[2].replace(/-/g, ":") : (obj.LastModified?.toISOString() ?? "");

    backups.push({
      key: obj.Key,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified?.toISOString() ?? "",
      tenantId,
      timestamp,
    });
  }

  // Sort by last modified, newest first
  backups.sort((a, b) => b.lastModified.localeCompare(a.lastModified));

  return backups;
}

/**
 * Deletes a backup from S3.
 */
export async function deleteTenantBackup(params: {
  key: string;
  config: BackupConfig;
}): Promise<void> {
  const { key, config } = params;
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

  const s3 = await createS3Client(config);
  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
}

/**
 * Prunes old backups, keeping only the most recent N.
 */
export async function pruneTenantBackups(params: {
  tenantId: TenantId;
  config: BackupConfig;
  keepCount: number;
}): Promise<string[]> {
  const { tenantId, config, keepCount } = params;

  const backups = await listTenantBackups({ tenantId, config });

  if (backups.length <= keepCount) {
    return [];
  }

  const toDelete = backups.slice(keepCount);
  const deletedKeys: string[] = [];

  for (const backup of toDelete) {
    await deleteTenantBackup({ key: backup.key, config });
    deletedKeys.push(backup.key);
  }

  return deletedKeys;
}
