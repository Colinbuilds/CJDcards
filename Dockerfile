# Used by Railway (or any Docker host) to serve the site. GitHub Pages ignores this file.
FROM caddy:2.8.4-alpine
COPY Caddyfile /etc/caddy/Caddyfile
# Only the website files. source/, build/, reports/ and tests/ are not served.
COPY index.html storefront.html tracker.html labels.html /srv/
COPY assets /srv/assets
COPY data /srv/data
