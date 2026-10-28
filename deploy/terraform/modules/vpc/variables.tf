variable "name_prefix" {
  description = "Name prefix for VPC resources (example: bleedstop-staging)."
  type        = string
}

variable "cidr_block" {
  description = "VPC IPv4 CIDR."
  type        = string
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Public subnet CIDR inside the VPC."
  type        = string
  default     = "10.42.1.0/24"
}

variable "availability_zone" {
  description = "AZ for the public subnet (example: us-east-1a)."
  type        = string
}

variable "create_secondary_public_subnet" {
  description = "Second public subnet in another AZ (needed for EKS / multi-AZ RDS)."
  type        = bool
  default     = false
}

variable "secondary_public_subnet_cidr" {
  description = "CIDR for the optional second public subnet."
  type        = string
  default     = "10.42.2.0/24"
}

variable "secondary_availability_zone" {
  description = "AZ for the second public subnet. Required when create_secondary_public_subnet is true."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags applied to every resource."
  type        = map(string)
  default     = {}
}
