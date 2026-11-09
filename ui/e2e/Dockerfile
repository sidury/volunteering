# Browser tests, kept out of the app image.
#   docker build -t vol-e2e ui/e2e
FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /opt/e2e
RUN npm init -y >/dev/null && npm install --no-audit --no-fund @playwright/test@1.49.1
