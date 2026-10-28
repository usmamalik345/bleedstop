output "vpc_id" {
  description = "ID of the staging VPC."
  value       = aws_vpc.this.id
}

output "public_subnet_id" {
  description = "ID of the public subnet where the app EC2 lives."
  value       = aws_subnet.public.id
}

output "public_subnet_ids" {
  description = "All public subnet IDs (1 or 2)."
  value = compact(concat(
    [aws_subnet.public.id],
    try([aws_subnet.public_secondary[0].id], [])
  ))
}

output "vpc_cidr_block" {
  description = "VPC CIDR (useful for security group rules later)."
  value       = aws_vpc.this.cidr_block
}
