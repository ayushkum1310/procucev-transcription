FROM node:22-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html main.jsx style.css ./
COPY public ./public
RUN npm run build

FROM python:3.11-slim
ENV HF_HUB_DISABLE_XET=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY --from=frontend /app/dist ./dist
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --ws-max-size 32768 --ws-max-queue 8"]
