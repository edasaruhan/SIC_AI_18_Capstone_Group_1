# Tek komutla tüm kontroller: make test
.PHONY: test test-python test-extension

test: test-python test-extension

test-python:
	python -m pytest tests -q -rs

test-extension:
	cd extension && npm run check
