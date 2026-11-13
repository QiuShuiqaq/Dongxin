#!/usr/bin/env bash
# Install a renewed API certificate for the unprivileged MQTT service.
# Certbot invokes this for each renewed lineage; only Dongxin names are handled.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root or a Certbot deploy hook' >&2; exit 1; }

api_lineage=/etc/letsencrypt/live/api.zjdongxin.net
ops_lineage=/etc/letsencrypt/live/ops.zjdongxin.net
lineage=${RENEWED_LINEAGE:-$api_lineage}
if [[ $lineage != "$api_lineage" && $lineage != "$ops_lineage" ]]; then
    exit 0
fi
[[ -f $lineage/fullchain.pem && -f $lineage/privkey.pem ]] || {
    echo "Certificate lineage is incomplete: $lineage" >&2; exit 1;
}
hostname=api.zjdongxin.net
[[ $lineage == "$ops_lineage" ]] && hostname=ops.zjdongxin.net
openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost "$hostname" >/dev/null
openssl x509 -in "$lineage/fullchain.pem" -noout -checkend 604800 >/dev/null
certificate_key=$(openssl x509 -in "$lineage/fullchain.pem" -pubkey -noout |
    openssl pkey -pubin -outform DER | sha256sum)
private_key=$(openssl pkey -in "$lineage/privkey.pem" -pubout -outform DER | sha256sum)
[[ ${certificate_key%% *} == "${private_key%% *}" ]] || {
    echo "Certificate and private key do not match: $hostname" >&2; exit 1;
}
nginx -t

if [[ $lineage == "$api_lineage" ]]; then
    cert_dir=/etc/dongxin/mqtt
    install -d -o dongxin -g dongxin -m 0700 "$cert_dir"
    install -d -m 0700 /var/backups/dongxin
    backup_dir=$(mktemp -d /var/backups/dongxin/mqtt-certificate-XXXXXXXX)
    new_cert=$(mktemp "$cert_dir/.fullchain-XXXXXXXX")
    new_key=$(mktemp "$cert_dir/.privkey-XXXXXXXX")
    trap 'rm -f -- "$new_cert" "$new_key"' EXIT
    install -o dongxin -g dongxin -m 0600 "$lineage/fullchain.pem" "$new_cert"
    install -o dongxin -g dongxin -m 0600 "$lineage/privkey.pem" "$new_key"
    had_previous=false
    if [[ -e $cert_dir/fullchain.pem || -e $cert_dir/privkey.pem ]]; then
        [[ -f $cert_dir/fullchain.pem && -f $cert_dir/privkey.pem ]] || {
            echo 'Existing MQTT certificate pair is incomplete' >&2; exit 1;
        }
        install -m 0600 "$cert_dir/fullchain.pem" "$backup_dir/fullchain.pem"
        install -m 0600 "$cert_dir/privkey.pem" "$backup_dir/privkey.pem"
        had_previous=true
    fi

    restore_mqtt() {
        trap - ERR
        if [[ $had_previous == true ]]; then
            install -o dongxin -g dongxin -m 0600 "$backup_dir/fullchain.pem" "$cert_dir/fullchain.pem"
            install -o dongxin -g dongxin -m 0600 "$backup_dir/privkey.pem" "$cert_dir/privkey.pem"
            systemctl restart dongxin-mqtt || true
            echo "MQTT certificate activation failed; restored previous pair from $backup_dir" >&2
        else
            rm -f -- "$cert_dir/fullchain.pem" "$cert_dir/privkey.pem"
            systemctl stop dongxin-mqtt || true
            echo 'MQTT certificate activation failed; no previous certificate pair was available' >&2
        fi
        exit 1
    }
    trap restore_mqtt ERR
    mv -f -- "$new_cert" "$cert_dir/fullchain.pem"
    mv -f -- "$new_key" "$cert_dir/privkey.pem"
    systemctl restart dongxin-mqtt
    systemctl is-active --quiet dongxin-mqtt
    tls_ready=false
    for ((attempt=0; attempt<10; attempt++)); do
        if timeout 3 openssl s_client -connect 127.0.0.1:8883 \
            -servername "$hostname" -verify_hostname "$hostname" \
            -verify_return_error </dev/null >/dev/null 2>&1; then
            tls_ready=true
            break
        fi
        sleep 1
    done
    [[ $tls_ready == true ]]
    trap - ERR
    echo "MQTT certificate installed for $hostname; previous pair: $backup_dir"
fi

systemctl reload nginx
echo "Nginx reloaded for $hostname"
