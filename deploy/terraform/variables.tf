variable "aws_region" {
  description = "AWS region for staging (example: us-east-1)."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name used in tags and resource names."
  type        = string
  default     = "staging"
}

variable "name_prefix" {
  description = "Prefix for resource names. Keep short."
  type        = string
  default     = "bleedstop-staging"
}

variable "vpc_cidr" {
  description = "CIDR for the staging VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Public subnet CIDR."
  type        = string
  default     = "10.42.1.0/24"
}

variable "availability_zone" {
  description = "AZ for the public subnet. Leave empty to pick the first AZ in the region."
  type        = string
  default     = ""
}

variable "instance_type" {
  description = "EC2 instance type for the app host."
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "Root EBS volume size (GB)."
  type        = number
  default     = 30
}

variable "allocate_eip" {
  description = "Attach a stable Elastic IP."
  type        = bool
  default     = true
}

variable "enable_ssm" {
  description = "Enable AWS SSM shell access (recommended over open SSH)."
  type        = bool
  default     = true
}

variable "key_name" {
  description = "Optional EC2 key pair for SSH. Leave null if you only use SSM."
  type        = string
  default     = null
}

variable "ssh_cidr" {
  description = "Optional CIDR allowed on port 22 (your home/office /32). Null = no SSH ingress."
  type        = string
  default     = null

  validation {
    condition     = var.ssh_cidr == null || can(cidrhost(var.ssh_cidr, 0))
    error_message = "ssh_cidr must be a valid CIDR like 203.0.113.10/32, or null."
  }
}

# --- Optional extras (default OFF — costs money) ---

variable "secondary_public_subnet_cidr" {
  description = "Second public subnet CIDR when RDS/Redis/EKS is enabled."
  type        = string
  default     = "10.42.2.0/24"
}

variable "secondary_availability_zone" {
  description = "Second AZ. Empty = auto-pick another AZ in the region."
  type        = string
  default     = ""
}

variable "enable_rds" {
  description = "Create managed Postgres (RDS). Default false — Compose Postgres is enough for learning."
  type        = bool
  default     = false
}

variable "rds_db_name" {
  type    = string
  default = "bleedstop"
}

variable "rds_username" {
  type    = string
  default = "bleedstop"
}

variable "rds_password" {
  description = "Required when enable_rds=true. Set via TF_VAR_rds_password or tfvars — never commit."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = !var.enable_rds || length(var.rds_password) >= 8
    error_message = "When enable_rds=true, rds_password must be at least 8 characters."
  }
}

variable "rds_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "enable_elasticache" {
  description = "Create managed Redis (ElastiCache). Default false."
  type        = bool
  default     = false
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "enable_eks" {
  description = "Create a small EKS cluster for the Helm chart. Default false — expensive."
  type        = bool
  default     = false
}

variable "eks_kubernetes_version" {
  type    = string
  default = "1.29"
}

variable "eks_node_instance_type" {
  type    = string
  default = "t3.medium"
}

variable "eks_node_desired_size" {
  type    = number
  default = 2
}
