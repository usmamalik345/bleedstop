output "app_security_group_id" {
  description = "Security group ID attached to the app EC2."
  value       = aws_security_group.app.id
}
