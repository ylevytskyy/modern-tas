# S9 PoT — Asterisk image. Same Ubuntu 24.04 + asterisk approach as S1/S3.
# Minimal: PJSIP transport + dialplan only; no ARI, no Stasis, no realtime.
FROM ubuntu:24.04

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      asterisk \
      asterisk-modules \
      iproute2 \
      curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN chown -R root:root /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk 2>/dev/null || true

USER root
EXPOSE 5060/udp 10000-10010/udp

CMD ["/usr/sbin/asterisk", "-fvvvn"]
