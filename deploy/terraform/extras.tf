# Optional managed extras — ALL default OFF so staging stays cheap (EC2 + Compose).
# Flip flags in terraform.tfvars only when you accept the AWS bill.

module "rds" {
  count  = var.enable_rds ? 1 : 0
  source = "./modules/rds"

  name_prefix           = var.name_prefix
  vpc_id                = module.vpc.vpc_id
  subnet_ids            = module.vpc.public_subnet_ids
  app_security_group_id = module.security.app_security_group_id
  db_name               = var.rds_db_name
  username              = var.rds_username
  password              = var.rds_password
  instance_class        = var.rds_instance_class
  publicly_accessible   = false
  tags                  = local.common_tags
}

module "elasticache" {
  count  = var.enable_elasticache ? 1 : 0
  source = "./modules/elasticache"

  name_prefix           = var.name_prefix
  vpc_id                = module.vpc.vpc_id
  subnet_ids            = module.vpc.public_subnet_ids
  app_security_group_id = module.security.app_security_group_id
  node_type             = var.redis_node_type
  tags                  = local.common_tags
}

module "eks" {
  count  = var.enable_eks ? 1 : 0
  source = "./modules/eks"

  name_prefix        = var.name_prefix
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.public_subnet_ids
  kubernetes_version = var.eks_kubernetes_version
  node_instance_type = var.eks_node_instance_type
  node_desired_size  = var.eks_node_desired_size
  tags               = local.common_tags
}
