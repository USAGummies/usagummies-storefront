#!/bin/bash
# add-blog-post.sh — Add a blog post directly to main and deploy
# Usage: ./scripts/add-blog-post.sh <slug>
# Example: ./scripts/add-blog-post.sh my-new-post
#
# WORKFLOW:
# 1. Create your .mdx file in content/blog/<slug>.mdx
# 2. Run this script with the slug
# 3. It commits to main and pushes → Vercel auto-deploys
#
# This script NEVER creates branches. Blog content goes straight to main.

set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "Usage: $0 <slug>"
  echo "Example: $0 my-new-post"
  echo ""
  echo "Make sure content/blog/<slug>.mdx exists first."
  exit 1
fi

FILE="content/blog/${SLUG}.mdx"

if [ ! -f "$FILE" ]; then
  echo "ERROR: $FILE does not exist."
  echo "Create the .mdx file first, then run this script."
  exit 1
fi

# Ensure we're on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "ERROR: Not on main branch (currently on '$BRANCH')."
  echo "Switch to main first: git checkout main"
  exit 1
fi

# Ensure working tree is clean (except the new blog post)
if ! git diff --quiet HEAD -- ':!content/blog/'; then
  echo "ERROR: You have uncommitted changes outside content/blog/."
  echo "Commit or stash those changes first."
  exit 1
fi

# Validate frontmatter has required fields
for field in title description date category; do
  if ! grep -q "^${field}:" "$FILE"; then
    echo "ERROR: Missing required frontmatter field '${field}' in $FILE"
    exit 1
  fi
done

echo "✅ Validations passed"
echo "📝 Adding blog post: $SLUG"

# Stage only the blog file
git add "$FILE"

# Commit and push
git commit -m "blog: add ${SLUG}"
git push origin main

echo ""
echo "🚀 Done! Blog post committed to main and pushed."
echo "   Vercel will auto-deploy to production in ~60 seconds."
echo "   Preview: https://www.usagummies.com/blog/${SLUG}"
