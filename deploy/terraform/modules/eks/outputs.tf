output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "cluster_certificate_authority_data" {
  value     = aws_eks_cluster.this.certificate_authority[0].data
  sensitive = true
}

output "configure_kubectl" {
  description = "Command shape — pass your region (see root aws_region)."
  value       = "aws eks update-kubeconfig --name ${aws_eks_cluster.this.name} --region <aws_region>"
}
