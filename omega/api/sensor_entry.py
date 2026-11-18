"""Entry for the bundled sensor. Customers do not need a Python installation."""
import argparse
import multiprocessing

from host_runtime import application_root, start_sensor
from self_integrity import verify_release


def main():
    multiprocessing.freeze_support()
    parser = argparse.ArgumentParser()
    parser.add_argument('--endpoint')
    parser.add_argument('--service', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    verify_release(application_root())
    if not args.verify_only:
        if not args.endpoint:
            parser.error('Falta --endpoint')
        start_sensor(args.endpoint, service=args.service)


if __name__ == '__main__':
    main()
