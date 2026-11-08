import os

bind = f"0.0.0.0:{int(os.environ.get('PORT', '8000'))}"
workers = 2
worker_class = "gthread"
threads = 4
timeout = 30
accesslog = "-"
errorlog = "-"
capture_output = True
