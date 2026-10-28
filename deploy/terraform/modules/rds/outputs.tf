output "endpoint" {
  description = "RDS hostname:port"
  value       = aws_db_instance.this.endpoint
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "security_group_id" {
  value = aws_security_group.rds.id
}

output "database_url_example" {
  description = "Shape of DATABASE_URL (password redacted in docs — build locally)."
  value       = "postgres://${var.username}:SECRET@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${var.db_name}"
}
