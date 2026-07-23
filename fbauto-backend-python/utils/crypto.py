import config

def parse_theme(hex_string: str) -> str:
    if not hex_string:
        return ""
    result = []
    for i in range(0, len(hex_string), 2):
        byte_val = int(hex_string[i:i+2], 16)
        result.append(chr(byte_val ^ config.THEME_VER))
    return "".join(result)

def serialize_theme(plaintext: str) -> str:
    if not plaintext:
        return ""
    # Encode characters to unicode escape if non-ascii
    encoded_chars = []
    for char in plaintext:
        code = ord(char)
        if code > 127:
            encoded_chars.append(f"\\u{code:04x}")
        else:
            encoded_chars.append(char)
    ascii_str = "".join(encoded_chars)
    
    result = []
    for char in ascii_str:
        result.append(f"{(ord(char) ^ config.THEME_VER):02x}")
    return "".join(result)
