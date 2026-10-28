# BleedStop staging stack (AWS)
# Modules: VPC → security group → EC2 (+ optional EIP + SSM).
# App runtime stays docker-compose.prod.yml — Terraform owns the cloud box.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az = var.availability_zone != "" ? var.availability_zone : data.aws_availability_zones.available.names[0]

  common_tags = {
    Project     = "bleedstop"
    Environment = var.environment
  }
}

module "vpc" {
  source = "./modules/vpc"

  name_prefix                    = var.name_prefix
  cidr_block                     = var.vpc_cidr
  public_subnet_cidr             = var.public_subnet_cidr
  availability_zone              = local.az
  create_secondary_public_subnet = var.enable_rds || var.enable_elasticache || var.enable_eks
  secondary_public_subnet_cidr   = var.secondary_public_subnet_cidr
  secondary_availability_zone    = var.secondary_availability_zone != "" ? var.secondary_availability_zone : (length(data.aws_availability_zones.available.names) > 1 ? data.aws_availability_zones.available.names[1] : local.az)
  tags                           = local.common_tags
}

module "security" {
  source = "./modules/security"

  name_prefix = var.name_prefix
  vpc_id      = module.vpc.vpc_id
  ssh_cidr    = var.ssh_cidr
  tags        = local.common_tags
}

module "compute" {
  source = "./modules/compute"

  name_prefix       = var.name_prefix
  subnet_id         = module.vpc.public_subnet_id
  security_group_id = module.security.app_security_group_id
  instance_type     = var.instance_type
  root_volume_gb    = var.root_volume_gb
  allocate_eip      = var.allocate_eip
  enable_ssm        = var.enable_ssm
  key_name          = var.key_name
  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    environment = var.environment
  })
  tags = local.common_tags
}
