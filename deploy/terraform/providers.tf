provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "bleedstop"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
