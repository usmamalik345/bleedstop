output "primary_endpoint" {
  description = "Redis host:port for REDIS_URL"
  value       = "${aws_elasticache_cluster.this.cache_nodes[0].address}:${aws_elasticache_cluster.this.cache_nodes[0].port}"
}

output "security_group_id" {
  value = aws_security_group.redis.id
}
