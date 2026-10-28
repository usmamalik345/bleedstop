variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "At least two subnets in different AZs for the DB subnet group."
  type        = list(string)
}

variable "app_security_group_id" {
  type = string
}

variable "engine_version" {
  type    = string
  default = "16"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_name" {
  type    = string
  default = "bleedstop"
}

variable "username" {
  type    = string
  default = "bleedstop"
}

variable "password" {
  description = "Master password — pass via tfvars / env, never commit."
  type        = string
  sensitive   = true
}

variable "publicly_accessible" {
  type    = bool
  default = false
}

variable "backup_retention_days" {
  type    = number
  default = 1
}

variable "tags" {
  type    = map(string)
  default = {}
}
