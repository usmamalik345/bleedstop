output "instance_id" {
  description = "EC2 instance ID."
  value       = aws_instance.app.id
}

output "private_ip" {
  description = "Private IP inside the VPC."
  value       = aws_instance.app.private_ip
}

output "public_ip" {
  description = "Public IP (Elastic IP when allocate_eip=true)."
  value       = var.allocate_eip ? aws_eip.app[0].public_ip : aws_instance.app.public_ip
}
