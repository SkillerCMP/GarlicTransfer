import errno
import ipaddress
import socket
import threading
import unittest
from unittest.mock import patch

from poc.dt_backend import channel_host
from poc.dt_discovery import SRCH, discover_routes


def discovery_address(address):
    return b"host-address:" + ipaddress.IPv6Address(address).packed.hex().encode() + b"\n"


class ChannelHostTests(unittest.TestCase):
    def test_unavailable_interface_falls_back_to_ipv4(self):
        with patch("socket.if_nametoindex", side_effect=OSError("no such interface")):
            self.assertEqual(
                channel_host("192.168.1.20", "wlp4s0", discovery_address("fe80::1234"), True),
                "192.168.1.20",
            )

    def test_interface_name_is_converted_to_a_numeric_scope(self):
        with patch("socket.if_nametoindex", return_value=12):
            self.assertEqual(
                channel_host("192.168.1.20", "Ethernet", discovery_address("fe80::1234"), True),
                "fe80::1234%12",
            )

    def test_ipv4_mapped_response_uses_the_ipv4_channel(self):
        self.assertEqual(
            channel_host("192.168.1.20", "wlp4s0", discovery_address("::ffff:192.168.1.25"), True),
            "192.168.1.20",
        )

    def test_global_ipv6_does_not_need_a_scope(self):
        self.assertEqual(
            channel_host("192.168.1.20", "", discovery_address("2001:db8::1234"), True),
            "2001:db8::1234",
        )


class DiscoveryRouteTests(unittest.TestCase):
    def setUp(self):
        self.servers = []

    def add_server(self, address, port=0):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.bind((address, port))
        except OSError as exc:
            sock.close()
            if exc.errno == errno.EADDRNOTAVAIL:
                self.skipTest(f"loopback address {address} is not configured")
            raise
        sock.settimeout(0.1)
        self.servers.append(sock)

        def serve():
            while True:
                try:
                    request, peer = sock.recvfrom(4096)
                except socket.timeout:
                    continue
                except OSError:
                    return
                if not request.startswith(b"SRCH"):
                    continue
                response = (
                    b"HTTP/1.1 200 Ok\n"
                    + b"host-id:5C843CC6D727\n"
                    + b"host-type:PS5\n"
                    + b"host-name:" + address.encode() + b"\n"
                    + b"host-request-port:1004\n"
                    + b"device-discovery-protocol-version:00030010\n"
                    + b"system-version:13600007\n"
                )
                sock.sendto(response, peer)

        threading.Thread(target=serve, daemon=True).start()
        return sock.getsockname()[1]

    def tearDown(self):
        for sock in self.servers:
            sock.close()

    def test_multiple_bound_routes_collect_every_response(self):
        port = self.add_server("127.0.0.1")
        self.assertEqual(self.add_server("127.0.0.2", port), port)
        consoles = discover_routes([
            ("127.0.0.1", "127.0.0.1"),
            ("127.0.0.1", "127.0.0.2"),
        ], 0.5, port)
        self.assertEqual({item["host"] for item in consoles}, {"127.0.0.1", "127.0.0.2"})

    def test_unbound_directed_route_uses_unicast(self):
        port = self.add_server("127.0.0.1")
        consoles = discover_routes([("", "127.0.0.1")], 0.5, port)
        self.assertEqual(len(consoles), 1)
        self.assertEqual(consoles[0]["host"], "127.0.0.1")
        self.assertEqual(consoles[0]["firmware"], "13600007")


if __name__ == "__main__":
    unittest.main()
