# Small staging VPC: one public subnet, internet gateway, no NAT.
# Why no NAT? NAT Gateway costs money every month; for a portfolio box
# we put the app in a public subnet and lock it with a security group.

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-vpc"
  })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-igw"
  })
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public"
    Tier = "public"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_subnet" "public_secondary" {
  count = var.create_secondary_public_subnet ? 1 : 0

  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.secondary_public_subnet_cidr
  availability_zone       = var.secondary_availability_zone
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public-b"
    Tier = "public"
  })
}

resource "aws_route_table_association" "public_secondary" {
  count = var.create_secondary_public_subnet ? 1 : 0

  subnet_id      = aws_subnet.public_secondary[0].id
  route_table_id = aws_route_table.public.id
}
