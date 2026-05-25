#!/usr/bin/env bash
# Install system dependencies for audio processing
apt-get update
apt-get install -y \
    ffmpeg \
    libavcodec-extra \
    libaudio-dev \
    python3-dev \
    build-essential

