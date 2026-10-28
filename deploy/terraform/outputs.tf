output "vpc_id" {
  description = "Staging VPC ID."
  value       = module.vpc.vpc_id
}

output "public_subnet_id" {
  description = "Public subnet ID."
  value       = module.vpc.public_subnet_id
}

output "app_security_group_id" {
  description = "App security group ID."
  value       = module.security.app_security_group_id
}

output "instance_id" {
  description = "EC2 instance ID (use with AWS SSM start-session)."
  value       = module.compute.instance_id
}

output "public_ip" {
  description = "Public IP — point your DOMAIN DNS A record here."
  value       = module.compute.public_ip
}

output "ssh_hint" {
  description = "How to reach the box after apply."
  value       = var.enable_ssm ? "aws ssm start-session --target ${module.compute.instance_id} --region ${var.aws_region}" : "SSH only if key_name + ssh_cidr were set"
}

output "next_steps" {
  description = "Human checklist after terraform apply."
  value       = <<-EOT
    1) DNS: create A record DOMAIN -> ${module.compute.public_ip}
    2) Shell: ${var.enable_ssm ? "aws ssm start-session --target ${module.compute.instance_id}" : "ssh with your key"}
    3) Put repo in /opt/bleedstop and create .env.production (see docs/PRODUCTION-READINESS.md)
    4) docker compose -f deploy/production/docker-compose.prod.yml --env-file .env.production up -d --build
    Optional: enable_rds / enable_elasticache / enable_eks in tfvars (see README)
  EOT
}

output "rds_endpoint" {
  description = "Set when enable_rds=true."
  value       = try(module.rds[0].endpoint, null)
}

output "redis_endpoint" {
  description = "Set when enable_elasticache=true."
  value       = try(module.elasticache[0].primary_endpoint, null)
}

output "eks_cluster_name" {
  description = "Set when enable_eks=true."
  value       = try(module.eks[0].cluster_name, null)
}
