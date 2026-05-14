# NAS Domain Fix Guide

This guide fixes the current public-domain path for `imageai.tw` without changing the app container or AI/storage providers.

## Current Diagnosis

- IP app works: `http://211.75.219.184:3050/health`
- `imageai.tw` DNS failed or returns SOA only, which means the apex domain has no usable A/AAAA record.
- `www.imageai.tw` points to Cloudflare IPs, but the apex domain does not resolve consistently.
- TLS shows a certificate principal mismatch for `imageai.tw`.
- Synology nginx 404 means the reverse proxy virtual host did not match `imageai.tw`, or Web Station/default nginx handled the request instead of the app.

## Step 1: DNS / Cloudflare

If the domain uses Cloudflare, set these records first.

Apex root domain:

| Field | Value |
| --- | --- |
| Type | A |
| Name | @ |
| IPv4 address | 211.75.219.184 |
| Proxy status | DNS only / gray cloud |
| TTL | Auto |

www, Option A:

| Field | Value |
| --- | --- |
| Type | CNAME |
| Name | www |
| Target | imageai.tw |
| Proxy status | DNS only / gray cloud |
| TTL | Auto |

www, Option B:

| Field | Value |
| --- | --- |
| Type | A |
| Name | www |
| IPv4 address | 211.75.219.184 |
| Proxy status | DNS only / gray cloud |
| TTL | Auto |

Notes:

- Do not put `:3050` in DNS. DNS records only point a name to a host, not to an app port.
- Start with DNS only / gray cloud, not orange cloud.
- Consider Cloudflare proxy only after the NAS certificate and reverse proxy pass.
- Remove or fix incorrect AAAA records if IPv6 is not configured on the router/NAS.
- If the apex lookup returns SOA only, the domain has no usable A/AAAA record.

## Step 2: Router / Firewall

Confirm router/firewall port forwarding:

- TCP `80` -> NAS LAN IP
- TCP `443` -> NAS LAN IP
- TCP `3050` does not have to stay open publicly after reverse proxy works; it can be internal-only.
- If Let's Encrypt fails, first confirm inbound `80/443` are not blocked by the router, firewall, or ISP.

## Step 3: Synology Reverse Proxy

DSM path:

Control Panel / 控制台
-> Login Portal / 登入入口
-> Advanced / 進階
-> Reverse Proxy / 反向代理伺服器

Add `imageai.tw`:

Description: `imageai`

Source:

- Protocol: HTTPS
- Hostname: imageai.tw
- Port: 443

Destination:

- Protocol: HTTP
- Hostname: 127.0.0.1
- Port: 3050

Add `www.imageai.tw`:

Description: `www-imageai`

Source:

- Protocol: HTTPS
- Hostname: www.imageai.tw
- Port: 443

Destination:

- Protocol: HTTP
- Hostname: 127.0.0.1
- Port: 3050

Notes:

- Source hostname must be `imageai.tw`. Do not enter `https://imageai.tw`, `imageai.tw:3050`, or the NAS IP address.
- Destination hostname can be `127.0.0.1` or `localhost`.
- If `curl -k https://imageai.tw/health` still returns Synology nginx 404, the Source hostname usually did not match, or Web Station/default nginx handled the request.
- Check for Web Station portal or default virtual host conflicts.

## Step 4: Synology Certificate

DSM path:

Control Panel / 控制台
-> Security / 安全性
-> Certificate / 憑證

Add a Let's Encrypt certificate:

- Domain name: imageai.tw
- Subject Alternative Name: www.imageai.tw
- Email: user's email

After the certificate is issued:

- Open Settings / 設定.
- Assign the `imageai` and `www-imageai` reverse proxy services to this `imageai.tw` certificate.
- Confirm the certificate SAN includes both `imageai.tw` and `www.imageai.tw`.

## Step 5: Verification Commands

PowerShell:

```powershell
nslookup imageai.tw
nslookup www.imageai.tw

Test-NetConnection imageai.tw -Port 80
Test-NetConnection imageai.tw -Port 443
Test-NetConnection 211.75.219.184 -Port 3050

curl.exe -I http://imageai.tw
curl.exe -I https://imageai.tw
curl.exe -I https://imageai.tw/health
curl.exe -I http://211.75.219.184:3050/health
```

Expected:

- `nslookup imageai.tw` -> `211.75.219.184`
- `Test-NetConnection imageai.tw -Port 443` -> `TcpTestSucceeded True`
- `https://imageai.tw/health` -> HTTP 200

## Step 6: App Verification

PowerShell:

```powershell
$env:DOMAIN_CHECK_BASE_URL="https://imageai.tw"
npm run domain:check

$env:SMOKE_BASE_URL="https://imageai.tw"
$env:SMOKE_EXPECT_PROVIDER="fake"
$env:SMOKE_EXPECT_STORAGE_DISK="local"
npm run smoke:staging
```

## Troubleshooting Matrix

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `nslookup imageai.tw` returns SOA only | Apex domain has no usable A/AAAA record | Add Cloudflare DNS A record `@ -> 211.75.219.184` with DNS only / gray cloud. |
| `nslookup www.imageai.tw` returns Cloudflare IP but apex fails | `www` exists but apex/root DNS is missing | Add apex A record `@ -> 211.75.219.184`; optionally make `www` a DNS-only CNAME to `imageai.tw`. |
| `Test-NetConnection imageai.tw` says name resolution failed | DNS has not propagated or apex record is missing | Recheck Cloudflare DNS, wait for propagation, and remove broken AAAA records if IPv6 is not configured. |
| TLS `SEC_E_WRONG_PRINCIPAL` | Certificate does not include `imageai.tw` | Issue a Let's Encrypt certificate for `imageai.tw` with SAN `www.imageai.tw`, then assign it to both reverse proxy services. |
| `curl -k https://imageai.tw/health` returns Synology nginx 404 | Reverse proxy Source hostname did not match, or Web Station/default nginx handled the request | Create or fix reverse proxy Source `HTTPS imageai.tw 443` -> Destination `HTTP 127.0.0.1 3050`; check Web Station/default virtual host conflicts. |
| Let's Encrypt fails | Inbound `80/443` blocked or DNS does not point to the NAS | Confirm DNS A record, router forwarding, NAS firewall, and ISP inbound port policy. |
| `/health` over IP works but domain fails | App container is healthy; public domain path is broken | Fix DNS apex, certificate assignment, and Synology reverse proxy vhost. |
| HTTP works but HTTPS fails | Certificate or HTTPS reverse proxy service is missing/misassigned | Issue the certificate and assign it to `imageai` / `www-imageai`; confirm Source protocol HTTPS port 443. |
| HTTPS works but login/session fails | APP_URL/PUBLIC_URL/cookie/proxy trust mismatch | Set `APP_URL` and `PUBLIC_URL` to `https://imageai.tw`, keep reverse proxy headers intact, then rerun `npm run domain:check`. |
