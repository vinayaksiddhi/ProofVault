"""
ProofVault Connectivity & Environment Handshake Verification Script
B.L.A.S.T. Protocol: Phase 2 — Link
Deterministic, read-only diagnostic checks for local and remote infrastructure.
Zero external dependencies required (uses Python standard library).
"""

import json
import os
import socket
import sys
import urllib.request
import urllib.error

def check_socket(host: str, port: int, timeout: float = 2.0) -> bool:
    """Test if a TCP port is open and listening."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.close()
        return True
    except Exception:
        return False

def check_json_rpc(rpc_url: str, expected_chain_id: int = None, timeout: float = 4.0):
    """Perform read-only eth_chainId and eth_blockNumber JSON-RPC checks."""
    payload = json.dumps([
        {"jsonrpc": "2.0", "method": "eth_chainId", "params": [], "id": 1},
        {"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 2}
    ]).encode("utf-8")

    req = urllib.request.Request(
        rpc_url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "ProofVault-Link-Diagnostic/1.0"}
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 200:
                body = json.loads(response.read().decode("utf-8"))
                chain_id_hex = None
                block_number_hex = None
                
                for item in body:
                    if item.get("id") == 1:
                        chain_id_hex = item.get("result")
                    elif item.get("id") == 2:
                        block_number_hex = item.get("result")
                        
                chain_id = int(chain_id_hex, 16) if chain_id_hex else None
                block_number = int(block_number_hex, 16) if block_number_hex else None
                
                is_chain_match = (chain_id == expected_chain_id) if expected_chain_id else True
                return {
                    "reachable": True,
                    "chain_id": chain_id,
                    "chain_id_hex": chain_id_hex,
                    "expected_chain_id": expected_chain_id,
                    "chain_match": is_chain_match,
                    "block_number": block_number,
                    "error": None
                }
    except Exception as e:
        return {
            "reachable": False,
            "chain_id": None,
            "chain_id_hex": None,
            "expected_chain_id": expected_chain_id,
            "chain_match": False,
            "block_number": None,
            "error": str(e)
        }

def run_diagnostics():
    print("=" * 70)
    print("PROOFVAULT PHASE 2 (LINK) CONNECTIVITY HANDSHAKE DIAGNOSTICS")
    print("=" * 70)

    # 1. Environment & Configuration Files
    env_exists = os.path.exists(".env")
    env_example_exists = os.path.exists(".env.example")
    print(f"\n[1] Configuration Files:")
    print(f"    - .env.example present: {env_example_exists}")
    print(f"    - .env present:         {env_exists} (No secrets printed)")

    # 2. PostgreSQL Service Check (Local Port 5432)
    pg_port_open = check_socket("127.0.0.1", 5432)
    print(f"\n[2] PostgreSQL Service (Port 5432):")
    if pg_port_open:
        print("    - Status: Port 5432 is OPEN and listening.")
    else:
        print("    - Status: Port 5432 is CLOSED (Service not running or not listening).")

    # 3. Local Hardhat Development RPC Check (Port 8545)
    hardhat_port_open = check_socket("127.0.0.1", 8545)
    print(f"\n[3] Local Hardhat RPC (http://127.0.0.1:8545):")
    if hardhat_port_open:
        res = check_json_rpc("http://127.0.0.1:8545", expected_chain_id=31337)
        if res["reachable"]:
            print(f"    - Status: Connected")
            print(f"    - Chain ID: {res['chain_id']} (Expected: 31337 -> Match: {res['chain_match']})")
            print(f"    - Latest Block Number: {res['block_number']}")
        else:
            print(f"    - Status: Port open but RPC call failed: {res['error']}")
    else:
        print("    - Status: UNREACHABLE (Port 8545 closed; local Hardhat node is not running).")

    # 4. Ethereum Sepolia Public RPC Endpoint Check (Read-Only)
    # Using a reputable public fallback endpoint for read-only validation
    sepolia_public_rpc = "https://ethereum-sepolia-rpc.publicnode.com"
    print(f"\n[4] Ethereum Sepolia Public Network Check (Read-Only via {sepolia_public_rpc}):")
    sepolia_res = check_json_rpc(sepolia_public_rpc, expected_chain_id=11155111, timeout=5.0)
    if sepolia_res["reachable"]:
        print(f"    - Status: Connected")
        print(f"    - Chain ID: {sepolia_res['chain_id']} (Expected: 11155111 -> Match: {sepolia_res['chain_match']})")
        print(f"    - Latest Block Number: {sepolia_res['block_number']}")
    else:
        print(f"    - Status: Unreachable / Timeout: {sepolia_res['error']}")

    print("\n" + "=" * 70)
    print("DIAGNOSTICS SUMMARY COMPLETE")
    print("=" * 70)

if __name__ == "__main__":
    run_diagnostics()
