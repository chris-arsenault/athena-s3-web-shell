terraform {
  required_version = ">= 1.12"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.22"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in the ahara-platform shared bucket following the platform
  # convention `projects/<name>.tfstate`.
  #
  # If you prefer local state for an ephemeral demo run, delete this whole
  # `backend "s3"` block and Terraform will use a local file. Re-add it to
  # move state back to S3 later.
  backend "s3" {
    bucket       = "tfstate-559098897826"
    key          = "projects/athena-shell.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
