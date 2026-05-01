#!/bin/bash

echo "========================================================"
echo "Asset Closet App Launcher (HTTPS)"
echo "========================================================"
echo ""
echo "Detecting Network Interfaces..."
echo ""

ALL_IPS=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}')

if [ -z "$ALL_IPS" ]; then
    ALL_IPS=$(python3 -c "import socket; print(socket.gethostbyname(socket.gethostname()))")
fi

echo "Available IP Addresses:"
echo "$ALL_IPS"
echo ""

# Build allowedDevOrigins array for next.config.ts
ORIGINS=""
for ip in $ALL_IPS; do
    if [ -n "$ORIGINS" ]; then
        ORIGINS="$ORIGINS, \"$ip\""
    else
        ORIGINS="\"$ip\""
    fi
done

echo "Updating next.config.ts with allowedDevOrigins: [$ORIGINS]"

cd "$(dirname "$0")"

# Update allowedDevOrigins in next.config.ts
if grep -q "allowedDevOrigins" next.config.ts; then
    sed -i '' "s/allowedDevOrigins: \[.*\]/allowedDevOrigins: [$ORIGINS]/" next.config.ts
else
    sed -i '' "s/devIndicators: false,/devIndicators: false,\n  allowedDevOrigins: [$ORIGINS],/" next.config.ts
fi

# Generate SSL cert if missing
if [ ! -f "cert.pem" ] || [ ! -f "key.pem" ]; then
    echo "Generating self-signed SSL certificate..."
    IP_SANS=""
    for ip in $ALL_IPS; do
        IP_SANS="$IP_SANS,IP:$ip"
    done
    openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem \
        -days 365 -nodes -subj "/CN=asset-closet.local" \
        -addext "subjectAltName=DNS:localhost${IP_SANS}" 2>/dev/null
    echo "SSL certificate generated."
fi

echo ""
echo "--------------------------------------------------------"
echo "Instructions:"
echo "1. Identify your Local Wi-Fi IP from the list above."
echo "   - It usually starts with '192.168...' or '10...'"
echo ""
echo "2. On your other device, open a browser and go to:"
echo "   https://<YOUR_LOCAL_IP>:3001"
echo "   (Example: https://192.168.1.15:3001)"
echo ""
echo "3. If Safari shows a certificate warning, tap:"
echo "   'Show Details' > 'Visit this website' > 'Visit Website'"
echo "--------------------------------------------------------"
echo ""
echo "Starting services..."
echo "1. Preventing sleep (caffeinate)..."
echo "2. Starting Asset Closet on Port 3001 (HTTPS)..."

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

caffeinate -i npx next dev -p 3001 -H 0.0.0.0 --experimental-https --experimental-https-key key.pem --experimental-https-cert cert.pem &
APP_PID=$!

trap "kill $APP_PID; exit" SIGINT SIGTERM

wait
