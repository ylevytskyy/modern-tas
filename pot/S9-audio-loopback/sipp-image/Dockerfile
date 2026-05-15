# S9 PoT — SIPp 3.6.1 from source, same build pattern as S1's sipp-image.
# Public sipp images are inconsistent on arm64; building from source dodges
# that and gives us deterministic version pinning.

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

WORKDIR /work
USER root

ENTRYPOINT ["/usr/local/bin/sipp"]
