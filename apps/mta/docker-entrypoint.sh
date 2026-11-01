#!/bin/sh
# Email intake's MTA (#580): its TLS material, then Haraka in the foreground (logs on stdout, nothing kept on disk).
# A certificate mounted at /etc/haraka-tls (key.pem, cert.pem) is used as is; else a self-signed one for MTA_HOSTNAME
# is made at each start: senders encrypt opportunistically and do not check an MX's certificate.
set -eu
dir=/run/haraka-tls
mkdir -p "$dir"
if [ -f /etc/haraka-tls/key.pem ] && [ -f /etc/haraka-tls/cert.pem ]; then
  cp /etc/haraka-tls/key.pem /etc/haraka-tls/cert.pem "$dir/"
else
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=${MTA_HOSTNAME:-mx.jobbbox.ai}" \
    -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
fi
[ -f "$dir/dhparams.pem" ] || openssl dhparam -dsaparam -out "$dir/dhparams.pem" 2048 2>/dev/null
exec node /haraka/node_modules/Haraka/bin/haraka -c /haraka
