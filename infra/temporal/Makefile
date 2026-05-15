# Temporal self-host baseline — local kind + chained Helm releases.
# ADR-0015 §Evidence item 2 deliverable.
#
# Chain: bitnami/postgresql → bitnami/elasticsearch → temporal/temporal
# Bundled subcharts removed in chart v1.0.0-rc.2+; we provide PG + ES as
# separate Helm releases in the same namespace.
#
# ES chart: elastic/elasticsearch 8.5.1 (official Elastic Helm chart, ES 8.5.1).
# Uses docker.elastic.co images (free, no paywall). bitnami/elasticsearch charts
# (v21.x and v22.x) are behind the Bitnami paid-image gate since August 2025.
# Temporal 1.20+ supports ES v8; version: v8 set in values.local.yaml.
# NOTE: The official Elastic chart uses a fixed service name "elasticsearch-master"
# (driven by clusterName, not release name). values.local.yaml uses that hostname.

CLUSTER_NAME    := temporal-baseline
NAMESPACE       := temporal

TEMPORAL_REPO   := https://go.temporal.io/helm-charts
TEMPORAL_CHART  := temporal/temporal
TEMPORAL_RELEASE := temporal-baseline
TEMPORAL_VERSION := 1.2.0

BITNAMI_REPO    := https://charts.bitnami.com/bitnami
PG_CHART        := bitnami/postgresql
PG_RELEASE      := temporal-pg
PG_VERSION      := 18.6.5

ELASTIC_REPO    := https://helm.elastic.co
ES_CHART        := elastic/elasticsearch
ES_RELEASE      := temporal-es
ES_VERSION      := 8.5.1

.PHONY: cluster-up
cluster-up: check-prereqs
	kind create cluster --config kind-cluster.yaml
	kubectl cluster-info --context kind-$(CLUSTER_NAME)

.PHONY: check-prereqs
check-prereqs:
	@command -v kind    >/dev/null 2>&1 || { echo "ERROR: kind not found. Install: brew install kind"; exit 1; }
	@command -v helm    >/dev/null 2>&1 || { echo "ERROR: helm not found. Install: brew install helm"; exit 1; }
	@command -v kubectl >/dev/null 2>&1 || { echo "ERROR: kubectl not found. Install: brew install kubectl"; exit 1; }

.PHONY: chart-repos
chart-repos: check-prereqs
	helm repo add temporal $(TEMPORAL_REPO)
	helm repo add bitnami  $(BITNAMI_REPO)
	helm repo add elastic  $(ELASTIC_REPO)
	helm repo update

.PHONY: ns
ns:
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -

.PHONY: pg-install
pg-install: chart-repos ns
	helm upgrade --install $(PG_RELEASE) $(PG_CHART) \
		--version $(PG_VERSION) \
		--namespace $(NAMESPACE) \
		--values values.postgresql.yaml \
		--wait --timeout 5m

.PHONY: es-install
es-install: chart-repos ns
	helm upgrade --install $(ES_RELEASE) $(ES_CHART) \
		--version $(ES_VERSION) \
		--namespace $(NAMESPACE) \
		--values values.elasticsearch.yaml \
		--wait --timeout 10m

.PHONY: temporal-install
temporal-install: chart-repos ns
	helm upgrade --install $(TEMPORAL_RELEASE) $(TEMPORAL_CHART) \
		--version $(TEMPORAL_VERSION) \
		--namespace $(NAMESPACE) \
		--values values.local.yaml \
		--wait --timeout 10m

.PHONY: chart-install
chart-install: pg-install es-install temporal-install

.PHONY: pods
pods:
	kubectl get pods -n $(NAMESPACE)

.PHONY: port-forward
port-forward:
	@echo "Forwarding 7233 (gRPC) and 8080 (Web UI). Ctrl-C to stop."
	@echo "If Ctrl-C leaves orphan kubectl processes, kill them with: pkill -f 'kubectl port-forward'"
	kubectl port-forward -n $(NAMESPACE) svc/$(TEMPORAL_RELEASE)-frontend 7233:7233 & \
	kubectl port-forward -n $(NAMESPACE) svc/$(TEMPORAL_RELEASE)-web 8080:8080 & \
	wait

# Assumes /sprint-0/temporal-sdk-validation/ exists at the expected path
# relative to this Makefile (sibling of infra/, two levels up). Fails if moved.
.PHONY: hello
hello:
	cd ../../sprint-0/temporal-sdk-validation && pnpm run hello

.PHONY: down
down:
	kind delete cluster --name $(CLUSTER_NAME)
