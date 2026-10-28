variable "name_prefix" {
  description = "Name prefix for compute resources."
  type        = string
}

variable "subnet_id" {
  description = "Subnet for the EC2 instance."
  type        = string
}

variable "security_group_id" {
  description = "Security group attached to the instance."
  type        = string
}

variable "instance_type" {
  description = "EC2 size. t3.small is a good staging default."
  type        = string
  default     = "t3.small"
}

variable "key_name" {
  description = "Optional EC2 key pair name for SSH. Prefer SSM when possible."
  type        = string
  default     = null
}

variable "enable_ssm" {
  description = "Attach IAM role for AWS Systems Manager Session Manager."
  type        = bool
  default     = true
}

variable "allocate_eip" {
  description = "Give the instance a stable Elastic IP (small monthly cost if stopped wrongly)."
  type        = bool
  default     = true
}

variable "root_volume_gb" {
  description = "Root disk size in GB."
  type        = number
  default     = 30
}

variable "user_data" {
  description = "Cloud-init script run on first boot."
  type        = string
  default     = null
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}
