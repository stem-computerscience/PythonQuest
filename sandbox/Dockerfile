FROM python:3.12-slim
RUN useradd --system --uid 10001 student
WORKDIR /app
COPY runner.py server.py /app/
USER student
EXPOSE 8080
CMD ["python", "-I", "/app/server.py"]
