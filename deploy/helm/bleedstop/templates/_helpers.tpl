{{- define "bleedstop.name" -}}
bleedstop
{{- end -}}

{{- define "bleedstop.labels" -}}
app.kubernetes.io/name: {{ include "bleedstop.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
{{- end -}}
