# Fallback: drachtio/rtpengine community image.
# The sipwise APT path (https://deb.sipwise.com/sp-apt/sipwise.gpg) returned HTTP 403
# as of 2026-05-14 — the signed-by APT key URL is unavailable. Using the community image
# instead per plan lines 1361–1370.
FROM drachtio/rtpengine:latest

EXPOSE 22222/udp

CMD ["rtpengine", "--interface=eth0", "--listen-ng=0.0.0.0:22222", "--foreground", "--log-stderr"]
