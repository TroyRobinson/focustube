#!/bin/bash
# Quick script to clean cache and restart dev server
# Run with: ./restart.sh

echo "🧹 Cleaning .next cache..."
rm -rf .next

echo "🚀 Starting dev server..."
npm run dev
