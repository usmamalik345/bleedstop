# One Ubuntu EC2 that runs Docker Compose production stack
# (API + Postgres + Redis + Caddy) — same path as deploy/production/.

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# SSM (Systems Manager) lets you open a shell without opening SSH to the world.
resource "aws_iam_role" "ssm" {
  count = var.enable_ssm ? 1 : 0

  name = "${var.name_prefix}-ec2-ssm"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  count = var.enable_ssm ? 1 : 0

  role       = aws_iam_role.ssm[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ssm" {
  count = var.enable_ssm ? 1 : 0

  name = "${var.name_prefix}-ec2-ssm"
  role = aws_iam_role.ssm[0].name
  tags = var.tags
}

resource "aws_instance" "app" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.security_group_id]
  key_name                    = var.key_name
  iam_instance_profile        = var.enable_ssm ? aws_iam_instance_profile.ssm[0].name : null
  associate_public_ip_address = true
  user_data                   = var.user_data
  user_data_replace_on_change = true

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 — harder for SSRF token theft
    http_put_response_hop_limit = 1
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-app"
  })
}

resource "aws_eip" "app" {
  count  = var.allocate_eip ? 1 : 0
  domain = "vpc"

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-eip"
  })
}

resource "aws_eip_association" "app" {
  count         = var.allocate_eip ? 1 : 0
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app[0].id
}
