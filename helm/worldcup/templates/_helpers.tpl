{{- define "worldcup.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "worldcup.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "worldcup.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "worldcup.labels" -}}
app.kubernetes.io/name: {{ include "worldcup.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "worldcup.postgres.fullname" -}}
{{- printf "%s-postgres" (include "worldcup.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
