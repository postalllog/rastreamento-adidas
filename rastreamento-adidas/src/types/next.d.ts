import { Server as NetServer } from "http";
import { Server as IOServer } from "socket.io";
import { NextApiResponse } from "next";

export type NextApiResponseServerIO = NextApiResponse & {
  socket: {
    server: NetServer & {
      io?: IOServer;
    };
  };
};
