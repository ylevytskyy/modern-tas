# S3 PoT — Asterisk image with tcpdump for wire-level FIN measurement.
# Same Ubuntu 24.04 + asterisk approach as S2 (S2 README documents why
# andrius/asterisk and other public images aren't viable). The S3 probe
# captures WebSocket close on port 8088 from inside the container, so
# tcpdump must be on the image.
FROM ubuntu:24.04

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      asterisk \
      asterisk-modules \
      tcpdump \
      iproute2 \
      curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Compose's cap_add (NET_RAW for tcpdump) interacts with the Ubuntu
# asterisk package's capability handling such that DAC_OVERRIDE gets
# dropped — so even running as root we can't write /var/lib/asterisk
# (owned by asterisk:asterisk by the package). Reassign ownership to
# root to sidestep this.
RUN chown -R root:root /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk 2>/dev/null || true

USER root
EXPOSE 8088/tcp

CMD ["/usr/sbin/asterisk", "-fvvvn"]
