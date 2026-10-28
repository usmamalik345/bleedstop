terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Learning default: local state file (gitignored).
  # For a shared team later, switch to an S3 backend + DynamoDB lock.
  # backend "s3" {
  #   bucket         = "YOUR-TF-STATE-BUCKET"
  #   key            = "bleedstop/staging/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "YOUR-TF-LOCK-TABLE"
  #   encrypt        = true
  # }
}
