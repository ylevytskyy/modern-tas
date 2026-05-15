# S1 PoT — SIPp 3.6.x image, built from source. Public sipp images
# are inconsistent on arm64 (the S2 README documented why ctaloi/sipp
# can't be used); building from source dodges that.
#
# SIPp 3.6 (the last release before the project moved to the new GitHub
# repo's 3.7+ scheme) is the most-tested version for headless scenario
# replay and is fine for this PoT.
FROM ubuntu:24.04 AS build

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential \
      cmake \
      libsctp-dev \
      libssl-dev \
      libpcap-dev \
      libncurses-dev \
      ca-certificates \
      git && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --branch v3.6.1 --depth 1 https://github.com/SIPp/sipp.git
WORKDIR /src/sipp
RUN cmake . -DUSE_SSL=1 -DUSE_PCAP=1 && \
    make -j"$(nproc)"

FROM ubuntu:24.04
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      libsctp1 \
      libssl3 \
      libpcap0.8 \
      libncurses6 \
      tcpdump \
      ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/sipp/sipp /usr/local/bin/sipp
RUN chmod +x /usr/local/bin/sipp

# SIPp needs writeable /tmp for trace files.
WORKDIR /work
USER root

ENTRYPOINT ["/usr/local/bin/sipp"]
