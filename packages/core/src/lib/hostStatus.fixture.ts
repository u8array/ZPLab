// Replies measured on a ZD230, V89.21.46Z.
export const STX = "\u0002";
export const ETX = "\u0003";

export const ZD230_HI = "ZD230,V89.21.46Z,8,4096KB,";
export const ZD230_HS = `${STX}030,0,0,0892,000,0,0,0,000,0,0,0${ETX}\r\n${STX}000,0,0,0,1,2,0,0,0,0,3${ETX}\r\n${STX}1234${ETX}`;
export const ZD230_HW = `${STX}\r\n- DIR R:*.* \r\n* R:PRE.GRF     49924          \r\n\r\n-   7467008 bytes free R: RAM \r\n${ETX}`;
