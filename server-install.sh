#!/usr/bin/env bash
#
# OpenClaw Server Installation Script
# Installs OpenClaw with multi-tenancy support on Linux servers
#
# Usage: ./server-install.sh [OPTIONS]
#
# Options:
#   --non-interactive     Run without prompts (use defaults)
#   --with-docker         Install Docker alongside bwrap
#   --skip-service        Don't install systemd service
#   --port PORT           Gateway port (default: 18789)
#   --bind ADDR           Bind address: loopback|lan (default: lan)
#   --user USER           User to run service as (default: current user)
#   --prefix PATH         Install prefix (default: /usr/local)
#   --state-dir PATH      State directory (default: ~/.openclaw)
#   --dev                 Install from current directory (development mode)
#   --branch BRANCH       Git branch to install from (default: main)
#   --help                Show this help message
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
NON_INTERACTIVE=false
WITH_DOCKER=false
SKIP_SERVICE=false
GATEWAY_PORT=18789
BIND_MODE="lan"
RUN_USER="${SUDO_USER:-$USER}"
INSTALL_PREFIX="/usr/local"
STATE_DIR=""
DEV_MODE=false
GIT_BRANCH="main"
REPO_URL="https://github.com/anthropics/openclaw.git"

# Detected values
OS_ID=""
OS_VERSION=""
ARCH=""
PKG_MANAGER=""
NODE_VERSION=""
PNPM_VERSION=""
INSTALL_DIR=""
GATEWAY_TOKEN=""

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}  ✓${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_step() {
  echo ""
  echo -e "${BLUE}[$1]${NC} $2"
}

die() {
  log_error "$1"
  exit 1
}

confirm() {
  if [ "$NON_INTERACTIVE" = true ]; then
    return 0
  fi
  local prompt="$1 [y/N] "
  read -r -p "$prompt" response
  case "$response" in
    [yY][eE][sS]|[yY]) return 0 ;;
    *) return 1 ;;
  esac
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

version_gte() {
  # Compare versions: returns 0 if $1 >= $2
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

# ============================================================================
# Argument Parsing
# ============================================================================

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --non-interactive)
        NON_INTERACTIVE=true
        shift
        ;;
      --with-docker)
        WITH_DOCKER=true
        shift
        ;;
      --skip-service)
        SKIP_SERVICE=true
        shift
        ;;
      --port)
        GATEWAY_PORT="$2"
        shift 2
        ;;
      --bind)
        BIND_MODE="$2"
        shift 2
        ;;
      --user)
        RUN_USER="$2"
        shift 2
        ;;
      --prefix)
        INSTALL_PREFIX="$2"
        shift 2
        ;;
      --state-dir)
        STATE_DIR="$2"
        shift 2
        ;;
      --dev)
        DEV_MODE=true
        shift
        ;;
      --branch)
        GIT_BRANCH="$2"
        shift 2
        ;;
      --help)
        show_help
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done

  # Set default state dir based on user
  if [ -z "$STATE_DIR" ]; then
    if [ "$RUN_USER" = "root" ]; then
      STATE_DIR="/var/lib/openclaw"
    else
      STATE_DIR="$(eval echo ~"$RUN_USER")/.openclaw"
    fi
  fi
}

show_help() {
  head -30 "$0" | tail -25 | sed 's/^#//'
}

# ============================================================================
# Pre-flight Checks
# ============================================================================

check_prerequisites() {
  log_step "1/6" "Checking prerequisites..."

  # Check if running on Linux
  if [[ "$(uname -s)" != "Linux" ]]; then
    die "This script only supports Linux. Detected: $(uname -s)"
  fi
  log_success "Linux detected"

  # Detect OS distribution
  if [ -f /etc/os-release ]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    OS_ID="${ID}"
    OS_VERSION="${VERSION_ID:-unknown}"
  elif [ -f /etc/redhat-release ]; then
    OS_ID="rhel"
    OS_VERSION=$(cat /etc/redhat-release | grep -oE '[0-9]+\.[0-9]+' | head -1)
  else
    die "Could not detect OS distribution"
  fi
  log_success "Detected ${OS_ID} ${OS_VERSION}"

  # Detect architecture
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64)
      ARCH="x64"
      ;;
    aarch64|arm64)
      ARCH="arm64"
      ;;
    *)
      die "Unsupported architecture: $ARCH"
      ;;
  esac
  log_success "Architecture: $ARCH"

  # Detect package manager
  case "$OS_ID" in
    ubuntu|debian|pop|linuxmint)
      PKG_MANAGER="apt"
      ;;
    fedora|rhel|centos|rocky|almalinux|amzn)
      PKG_MANAGER="dnf"
      if ! command_exists dnf; then
        PKG_MANAGER="yum"
      fi
      ;;
    arch|manjaro)
      PKG_MANAGER="pacman"
      ;;
    opensuse*|sles)
      PKG_MANAGER="zypper"
      ;;
    *)
      die "Unsupported distribution: $OS_ID"
      ;;
  esac
  log_success "Package manager: $PKG_MANAGER"

  # Check for sudo/root access
  if [ "$EUID" -eq 0 ]; then
    log_success "Running as root"
  elif command_exists sudo; then
    if sudo -n true 2>/dev/null; then
      log_success "sudo access available (passwordless)"
    else
      log_success "sudo access available"
    fi
  else
    die "This script requires root or sudo access"
  fi

  # Check for systemd (if not skipping service)
  if [ "$SKIP_SERVICE" = false ]; then
    if ! command_exists systemctl; then
      log_warn "systemd not found - will skip service installation"
      SKIP_SERVICE=true
    else
      log_success "systemd available"
    fi
  fi
}

# ============================================================================
# System Dependencies
# ============================================================================

install_dependencies() {
  log_step "2/6" "Installing system dependencies..."

  local packages_to_install=()
  local need_node=false

  # Check for Node.js
  if command_exists node; then
    NODE_VERSION=$(node --version | sed 's/v//')
    if version_gte "$NODE_VERSION" "22.0.0"; then
      log_success "Node.js $NODE_VERSION installed"
    else
      log_warn "Node.js $NODE_VERSION is too old (need 22+)"
      need_node=true
    fi
  else
    need_node=true
  fi

  # Common packages needed
  local common_packages=(git curl jq python3)

  case "$PKG_MANAGER" in
    apt)
      sudo apt-get update -qq

      # Check and add missing packages
      for pkg in "${common_packages[@]}"; do
        if ! dpkg -l "$pkg" &>/dev/null; then
          packages_to_install+=("$pkg")
        fi
      done

      # Add bubblewrap
      if ! dpkg -l bubblewrap &>/dev/null; then
        packages_to_install+=("bubblewrap")
      fi

      # Install Node.js if needed
      if [ "$need_node" = true ]; then
        log_info "Installing Node.js 22.x from NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        packages_to_install+=("nodejs")
      fi

      # Install packages
      if [ ${#packages_to_install[@]} -gt 0 ]; then
        sudo apt-get install -y "${packages_to_install[@]}"
      fi
      ;;

    dnf|yum)
      # Check and add missing packages
      for pkg in "${common_packages[@]}"; do
        if ! rpm -q "$pkg" &>/dev/null; then
          packages_to_install+=("$pkg")
        fi
      done

      # Add bubblewrap
      if ! rpm -q bubblewrap &>/dev/null; then
        packages_to_install+=("bubblewrap")
      fi

      # Install Node.js if needed
      if [ "$need_node" = true ]; then
        log_info "Installing Node.js 22.x from NodeSource..."
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
        packages_to_install+=("nodejs")
      fi

      # Install packages
      if [ ${#packages_to_install[@]} -gt 0 ]; then
        sudo "$PKG_MANAGER" install -y "${packages_to_install[@]}"
      fi
      ;;

    pacman)
      for pkg in "${common_packages[@]}"; do
        if ! pacman -Q "$pkg" &>/dev/null; then
          packages_to_install+=("$pkg")
        fi
      done

      if ! pacman -Q bubblewrap &>/dev/null; then
        packages_to_install+=("bubblewrap")
      fi

      if [ "$need_node" = true ]; then
        packages_to_install+=("nodejs" "npm")
      fi

      if [ ${#packages_to_install[@]} -gt 0 ]; then
        sudo pacman -S --noconfirm "${packages_to_install[@]}"
      fi
      ;;

    zypper)
      for pkg in "${common_packages[@]}"; do
        if ! rpm -q "$pkg" &>/dev/null; then
          packages_to_install+=("$pkg")
        fi
      done

      if ! rpm -q bubblewrap &>/dev/null; then
        packages_to_install+=("bubblewrap")
      fi

      if [ "$need_node" = true ]; then
        packages_to_install+=("nodejs22")
      fi

      if [ ${#packages_to_install[@]} -gt 0 ]; then
        sudo zypper install -y "${packages_to_install[@]}"
      fi
      ;;
  esac

  # Verify Node.js installation
  NODE_VERSION=$(node --version | sed 's/v//')
  log_success "Node.js $NODE_VERSION installed"

  # Enable corepack for pnpm
  log_info "Enabling corepack for pnpm..."
  if [ "$EUID" -eq 0 ]; then
    corepack enable
  else
    sudo corepack enable
  fi

  # Get pnpm version
  PNPM_VERSION=$(pnpm --version 2>/dev/null || echo "not installed")
  if [ "$PNPM_VERSION" != "not installed" ]; then
    log_success "pnpm $PNPM_VERSION enabled"
  else
    # Fallback: install pnpm via npm
    log_info "Installing pnpm via npm..."
    sudo npm install -g pnpm
    PNPM_VERSION=$(pnpm --version)
    log_success "pnpm $PNPM_VERSION installed"
  fi

  # Check bubblewrap
  if command_exists bwrap; then
    log_success "bubblewrap installed"
  else
    die "bubblewrap installation failed"
  fi

  # Optional: Install Docker
  if [ "$WITH_DOCKER" = true ]; then
    install_docker
  fi
}

install_docker() {
  log_info "Installing Docker..."

  if command_exists docker; then
    log_success "Docker already installed"
    return
  fi

  case "$PKG_MANAGER" in
    apt)
      # Install Docker from official repository
      sudo apt-get install -y ca-certificates gnupg
      sudo install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/"$OS_ID"/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      sudo chmod a+r /etc/apt/keyrings/docker.gpg

      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS_ID \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

      sudo apt-get update
      sudo apt-get install -y docker-ce docker-ce-cli containerd.io
      ;;

    dnf|yum)
      sudo "$PKG_MANAGER" install -y yum-utils
      sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      sudo "$PKG_MANAGER" install -y docker-ce docker-ce-cli containerd.io
      ;;

    pacman)
      sudo pacman -S --noconfirm docker
      ;;

    zypper)
      sudo zypper install -y docker
      ;;
  esac

  # Start and enable Docker
  sudo systemctl enable docker
  sudo systemctl start docker

  # Add user to docker group
  if [ "$RUN_USER" != "root" ]; then
    sudo usermod -aG docker "$RUN_USER"
    log_warn "User $RUN_USER added to docker group. Log out and back in for this to take effect."
  fi

  log_success "Docker installed"
}

# ============================================================================
# OpenClaw Installation
# ============================================================================

install_openclaw() {
  log_step "3/6" "Installing OpenClaw..."

  if [ "$DEV_MODE" = true ]; then
    # Development mode: use current directory
    INSTALL_DIR="$(pwd)"
    if [ ! -f "$INSTALL_DIR/package.json" ]; then
      die "Not in OpenClaw directory. Run from the openclaw source root or omit --dev flag."
    fi
    log_success "Using development directory: $INSTALL_DIR"
  else
    # Production mode: clone repository
    INSTALL_DIR="$INSTALL_PREFIX/share/openclaw"

    if [ -d "$INSTALL_DIR" ]; then
      log_info "OpenClaw directory exists, pulling latest..."
      cd "$INSTALL_DIR"
      sudo git fetch origin
      sudo git checkout "$GIT_BRANCH"
      sudo git pull origin "$GIT_BRANCH"
    else
      log_info "Cloning OpenClaw repository..."
      sudo git clone --branch "$GIT_BRANCH" "$REPO_URL" "$INSTALL_DIR"
    fi
    log_success "Repository cloned"

    cd "$INSTALL_DIR"
  fi

  # Install dependencies
  log_info "Installing dependencies..."
  if [ "$DEV_MODE" = true ]; then
    pnpm install --frozen-lockfile
  else
    sudo -u "$RUN_USER" pnpm install --frozen-lockfile 2>/dev/null || sudo pnpm install --frozen-lockfile
  fi
  log_success "Dependencies installed"

  # Build
  log_info "Building OpenClaw..."
  if [ "$DEV_MODE" = true ]; then
    pnpm build
  else
    sudo -u "$RUN_USER" pnpm build 2>/dev/null || sudo pnpm build
  fi
  log_success "Build complete"

  # Create symlink
  local bin_path="$INSTALL_PREFIX/bin/openclaw"
  local cli_path="$INSTALL_DIR/dist/cli.js"

  if [ -L "$bin_path" ] || [ -f "$bin_path" ]; then
    sudo rm -f "$bin_path"
  fi

  sudo mkdir -p "$INSTALL_PREFIX/bin"
  sudo ln -s "$cli_path" "$bin_path"
  log_success "Created symlink: $bin_path -> $cli_path"
}

# ============================================================================
# Configuration
# ============================================================================

configure_openclaw() {
  log_step "4/6" "Configuring OpenClaw..."

  # Create state directory structure
  log_info "Creating state directory: $STATE_DIR"
  sudo mkdir -p "$STATE_DIR"/{workspace,tenants,agents,logs,sandboxes,metrics}

  # Set ownership
  if [ "$RUN_USER" != "root" ]; then
    sudo chown -R "$RUN_USER:$RUN_USER" "$STATE_DIR"
  fi
  log_success "State directory created"

  # Generate gateway token
  GATEWAY_TOKEN=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
  log_success "Gateway token generated"

  # Create configuration file
  local config_file="$STATE_DIR/openclaw.json"
  if [ ! -f "$config_file" ]; then
    cat > /tmp/openclaw-config.json << EOF
{
  "gateway": {
    "mode": "$BIND_MODE",
    "port": $GATEWAY_PORT,
    "multiTenancy": {
      "enabled": true,
      "sandboxBackend": "bwrap"
    }
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "non-main",
        "scope": "agent",
        "backend": "bwrap"
      }
    }
  }
}
EOF
    sudo mv /tmp/openclaw-config.json "$config_file"
    if [ "$RUN_USER" != "root" ]; then
      sudo chown "$RUN_USER:$RUN_USER" "$config_file"
    fi
    log_success "Configuration file created"
  else
    log_success "Configuration file exists (keeping existing)"
  fi

  # Create empty tenants registry
  local tenants_file="$STATE_DIR/tenants.json"
  if [ ! -f "$tenants_file" ]; then
    echo '{"version":1,"tenants":{}}' > /tmp/tenants.json
    sudo mv /tmp/tenants.json "$tenants_file"
    if [ "$RUN_USER" != "root" ]; then
      sudo chown "$RUN_USER:$RUN_USER" "$tenants_file"
    fi
    log_success "Tenants registry created"
  fi

  # Set permissions
  chmod 700 "$STATE_DIR"
  chmod 600 "$STATE_DIR/openclaw.json" 2>/dev/null || true
  chmod 600 "$STATE_DIR/tenants.json" 2>/dev/null || true
  log_success "Permissions set"
}

# ============================================================================
# Service Setup
# ============================================================================

setup_service() {
  if [ "$SKIP_SERVICE" = true ]; then
    log_step "5/6" "Skipping service setup (--skip-service)"
    return
  fi

  log_step "5/6" "Setting up systemd service..."

  local service_file="/etc/systemd/system/openclaw-gateway.service"
  local run_group
  run_group=$(id -gn "$RUN_USER")

  # Create systemd service file
  sudo tee "$service_file" > /dev/null << EOF
[Unit]
Description=OpenClaw Gateway
Documentation=https://github.com/anthropics/openclaw
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$run_group
ExecStart=$INSTALL_PREFIX/bin/openclaw gateway --port $GATEWAY_PORT
Restart=always
RestartSec=5
Environment=OPENCLAW_STATE_DIR=$STATE_DIR
Environment=OPENCLAW_GATEWAY_TOKEN=$GATEWAY_TOKEN
Environment=NODE_ENV=production

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$STATE_DIR
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

# Allow binding to privileged ports if needed
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
  log_success "Systemd service file created"

  # Create token file for reference
  local token_file="$STATE_DIR/.gateway-token"
  echo "$GATEWAY_TOKEN" | sudo tee "$token_file" > /dev/null
  sudo chmod 600 "$token_file"
  if [ "$RUN_USER" != "root" ]; then
    sudo chown "$RUN_USER:$RUN_USER" "$token_file"
  fi

  # Reload systemd
  sudo systemctl daemon-reload
  log_success "Systemd daemon reloaded"

  # Enable service
  sudo systemctl enable openclaw-gateway
  log_success "Service enabled"

  # Start service
  sudo systemctl start openclaw-gateway
  log_success "Service started"
}

# ============================================================================
# Post-Installation
# ============================================================================

verify_installation() {
  log_step "6/6" "Verifying installation..."

  # Check if openclaw command works
  if command_exists openclaw; then
    log_success "openclaw command available"
  else
    log_warn "openclaw command not in PATH"
  fi

  # Check service status (if installed)
  if [ "$SKIP_SERVICE" = false ]; then
    if systemctl is-active --quiet openclaw-gateway; then
      log_success "Gateway service is running"
    else
      log_warn "Gateway service is not running"
      log_info "Check logs with: journalctl -u openclaw-gateway -f"
    fi

    # Wait a moment for the service to be ready
    sleep 2

    # Try to reach the gateway
    local gateway_url
    if [ "$BIND_MODE" = "loopback" ]; then
      gateway_url="http://127.0.0.1:$GATEWAY_PORT"
    else
      gateway_url="http://localhost:$GATEWAY_PORT"
    fi

    if curl -s --max-time 5 "$gateway_url/health" >/dev/null 2>&1; then
      log_success "Gateway responding on port $GATEWAY_PORT"
    else
      log_warn "Gateway not responding yet (may still be starting)"
    fi
  fi

  # Run doctor (if available)
  if [ "$DEV_MODE" = false ] && command_exists openclaw; then
    log_info "Running openclaw doctor..."
    openclaw doctor 2>/dev/null || true
  fi
}

show_summary() {
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}   Installation Complete!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""

  # Get network address
  local ip_addr
  ip_addr=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

  if [ "$BIND_MODE" = "loopback" ]; then
    echo "Gateway URL: http://127.0.0.1:$GATEWAY_PORT"
  else
    echo "Gateway URL: http://$ip_addr:$GATEWAY_PORT"
  fi

  echo ""
  echo "Gateway Token: $GATEWAY_TOKEN"
  echo "State Directory: $STATE_DIR"
  echo ""
  echo "Token also saved to: $STATE_DIR/.gateway-token"
  echo ""
  echo -e "${BLUE}Next steps:${NC}"
  echo "  1. Create a tenant:"
  echo "     openclaw tenants create myapp"
  echo ""
  echo "  2. View service status:"
  echo "     systemctl status openclaw-gateway"
  echo ""
  echo "  3. View logs:"
  echo "     journalctl -u openclaw-gateway -f"
  echo ""
  echo "  4. Access the web UI:"
  if [ "$BIND_MODE" = "loopback" ]; then
    echo "     http://127.0.0.1:$GATEWAY_PORT"
  else
    echo "     http://$ip_addr:$GATEWAY_PORT"
  fi
  echo ""
}

# ============================================================================
# Cleanup on Error
# ============================================================================

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo ""
    log_error "Installation failed with exit code $exit_code"
    echo ""
    echo "To retry:"
    echo "  1. Check the error messages above"
    echo "  2. Run the script again"
    echo ""
    echo "To uninstall partial installation:"
    echo "  sudo rm -rf $STATE_DIR"
    echo "  sudo rm -f $INSTALL_PREFIX/bin/openclaw"
    echo "  sudo rm -f /etc/systemd/system/openclaw-gateway.service"
    echo "  sudo systemctl daemon-reload"
  fi
}

trap cleanup EXIT

# ============================================================================
# Main
# ============================================================================

main() {
  echo ""
  echo -e "${BLUE}OpenClaw Server Installation${NC}"
  echo "=============================="
  echo ""

  parse_args "$@"

  check_prerequisites
  install_dependencies
  install_openclaw
  configure_openclaw
  setup_service
  verify_installation
  show_summary
}

main "$@"
