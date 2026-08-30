#!/bin/bash
# ============================================
# PULSE - Setup Oracle Cloud VM (Ubuntu)
# WebRTC Voice + TURN Server
# ============================================

set -e

echo "=== PULSE Oracle Cloud Setup ==="

# 1. System updates
echo "[1/6] Atualizando sistema..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js (if not installed)
if ! command -v node &> /dev/null; then
  echo "[2/6] Instalando Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
else
  echo "[2/6] Node.js ja instalado: $(node -v)"
fi

# 3. Install coturn (TURN server)
echo "[3/6] Instalando coturn..."
sudo apt install -y coturn

# 4. Install pm2 for process management
if ! command -v pm2 &> /dev/null; then
  echo "[4/6] Instalando pm2..."
  sudo npm install -g pm2
else
  echo "[4/6] pm2 ja instalado"
fi

# 5. Get public IP
PUBLIC_IP=$(curl -s ifconfig.me)
echo "[5/6] IP Publico detectado: $PUBLIC_IP"

# 6. Configure coturn
echo "[6/6] Configurando coturn..."
TURN_SECRET="pulse_$(openssl rand -hex 8)"

sudo tee /etc/turnserver.conf > /dev/null <<EOF
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
user=pulse:${TURN_SECRET}
realm=pulse
min-port=49152
max-port=65535
external-ip=${PUBLIC_IP}
verbose
no-multicast-peers
no-cli
EOF

# Enable coturn in default config
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true

# 7. Configure UFW firewall
echo "Configurando firewall..."
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 3000/tcp  # PULSE server (HTTP)
sudo ufw allow 3478/tcp  # TURN TCP
sudo ufw allow 3478/udp  # TURN UDP
sudo ufw allow 5349/tcp  # TURNS TLS
sudo ufw allow 5349/udp  # TURNS TLS UDP
sudo ufw allow 49152:65535/udp  # WebRTC media
sudo ufw --force enable

# 8. Start coturn
sudo systemctl enable coturn
sudo systemctl restart coturn

# 9. Start PULSE
echo "Iniciando PULSE..."
cd "$(dirname "$0")"
pm2 stop pulse 2>/dev/null || true
pm2 start server.js --name pulse -- --port 3000
pm2 save

# 10. Print summary
echo ""
echo "==========================================="
echo "  SETUP COMPLETO!"
echo "==========================================="
echo ""
echo "  IP Publico:  ${PUBLIC_IP}"
echo "  PULSE:       http://${PUBLIC_IP}:3000"
echo "  TURN Server: turn:${PUBLIC_IP}:3478"
echo "  TURN User:   pulse"
echo "  TURN Pass:   ${TURN_SECRET}"
echo ""
echo "  Variaveis de ambiente pra definir:"
echo "    TURN_URL=turn:${PUBLIC_IP}:3478"
echo "    TURN_USERNAME=pulse"
echo "    TURN_CREDENTIAL=${TURN_SECRET}"
echo ""
echo "  No Oracle Cloud, garanta que as portas"
echo "  estao abertas na Security List:"
echo "    TCP: 22, 3000, 3478, 5349"
echo "    UDP: 3478, 5349, 49152-65535"
echo ""
echo "  Gerenciar com pm2:"
echo "    pm2 logs pulse"
echo "    pm2 restart pulse"
echo "    pm2 status"
echo "==========================================="
