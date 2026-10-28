variable "name_prefix" {
  description = "Name prefix for security resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC that owns the security group."
  type        = string
}

variable "ssh_cidr" {
  description = "Optional CIDR allowed to SSH (example: 203.0.113.10/32). Null = no SSH rule; prefer AWS SSM."
  type        = string
  default     = null
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}
