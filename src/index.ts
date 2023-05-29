import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { PubSub } from "graphql-subscriptions";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { useServer } from "graphql-ws/lib/use/ws";
import { nanoid } from "nanoid";

const PORT = 4000;
const pubsub = new PubSub();

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
const typeDefs = `#graphql
  # Comments in GraphQL strings (such as this one) start with the hash (#) symbol.

  # This "Book" type defines the queryable fields for every book in our data source.
  type Book {
    id: ID!
    title: String!
    description: String
    rating: Float
    author: String
    year: Int
  }

  input BookInput {
    title: String!
    description: String
    rating: Float
    author: String!
    year: Int!
  }

  input UpdateBookInput {
    id: ID!
    title: String
    description: String
    rating: Float
    author: String
    year: Int
  }

  # The "Query" type is special: it lists all of the available queries that
  # clients can execute, along with the return type for each. In this
  # case, the "books" query returns an array of zero or more Books (defined above).
  type Query {
    allBooks(search: String): [Book]
    getBook(id: ID!): Book!
  }

  type Mutation {
    addBook(input: BookInput!): Book!
    deleteBook(id: ID!): Boolean
    updateBook(input: UpdateBookInput!): Book!
  }

  type Subscription {
    bookSub: Book!
  }
`;

const books = [
  {
    id: "n12clfp3K",
    title: "The Guardians",
    description:
      "In the small Florida town of Seabrook, a young lawyer named Keith Russo was shot dead at his desk as he worked late one night. The killer left no clues. There were no witnesses, no one with a motive. But the police soon came to suspect Quincy Miller, a young black man who was once a client of Russo’s...",
    rating: 4.5,
    author: "John Grisham",
    year: 1970,
  },
  {
    id: "TaFvKQmgQ",
    title: "The Girl on the Train",
    description:
      "Rachel catches the same commuter train every morning. She knows it will wait at the same signal each time, overlooking a row of back gardens. She’s even started to feel like she knows the people who live in one of the houses. ‘Jess and Jason’, she calls them. Their life – as she sees it – is perfect. If only Rachel could be that happy...",
    rating: 4.2,
    author: "John Grisham",
    year: 2016,
  },
  {
    id: "3y-67bb6Z",
    title: "Fahrenheit 451",
    description: "The terrifyingly prophetic novel of a post-literate future.",
    rating: 4.6,
    author: "Ray Bradbury",
    year: 1953,
  },
  {
    id: "Rw3sPphui",
    title: "To Kill a Mockingbird",
    description:
      "The perennially beloved and treacly account of growing up in a small Southern town during the Depression....To read the novel is, for most, an exercise in wish-fulfillment and self-congratulation, a chance to consider thorny issues of race and prejudice from a safe distance and with the comfortable certainty that the reader would never harbor the racist attitudes espoused by the lowlifes in the novel.",
    rating: 4.6,
    author: "Harper Lee",
    year: 1960,
  },
  {
    id: "b8eWGRQo6",
    title: "The Shining",
    description:
      "Jack Torrance’s new job at the Overlook Hotel is the perfect chance for a fresh start. As the off-season caretaker at the atmospheric old hotel, he’ll have plenty of time to spend reconnecting with his family and working on his writing. But as the harsh winter weather sets in, the idyllic location feels ever more remote . . . and more sinister",
    rating: 4.7,
    author: "Stephen King",
    year: 1980,
  },
  {
    id: "HVL-jHzdH",
    title: "Foundation",
    description:
      "The first novel in Isaac Asimov’s classic science-fiction masterpiece, the Foundation series",
    rating: 4.5,
    author: "Isaak Asimov",
    year: 1942,
  },
  {
    id: "eqbOaeNk-",
    title: "The Catcher in the Rye",
    description:
      "The hero-narrator of The Catcher in the Rye is an ancient child of sixteen, a native New Yorker named Holden Caulfield.Through circumstances that tend to preclude adult, secondhand description, he leaves his prep school in Pennsylvania and goes underground in New York City for three days.",
    rating: 4.6,
    author: "J. D. Salinger",
    year: 1951,
  },
];

// Resolvers define how to fetch the types defined in your schema.
// This resolver retrieves books from the "books" array above.
const resolvers = {
  Query: {
    allBooks: (_, { search }) => {
      if (!search) {
        return books;
      }
      return books.filter((book) =>
        book.title.toLowerCase().includes(search.toLowerCase())
      );
    },

    getBook: (_, { id }) => books.find((book) => book.id === id),
  },

  Mutation: {
    addBook: (_, { input }) => {
      const newBook = {
        id: nanoid(),
        title: input.title,
        description: input.description || "",
        rating: input.rating || null,
        year: input.year,
        author: input.author,
      };
      books.push(newBook);

      // Publish the subscription event after adding the book
      pubsub.publish("bookSub", { addBook: newBook });

      return newBook;
    },

    deleteBook: (_, { id }) => {
      const index = books.findIndex((book) => book.id === id);
      if (index !== -1) {
        const deletedBook = books.splice(index, 1);
        return deletedBook[0];
      }
      return null;
    },

    updateBook: (_, { input }) => {
      const { id } = input;
      const bookToUpdate = books.find((book) => book.id === id);
      if (bookToUpdate) {
        bookToUpdate.title = input.title || bookToUpdate.title;
        bookToUpdate.description =
          input.description || bookToUpdate.description;
        bookToUpdate.author = input.author || bookToUpdate.author;
        bookToUpdate.year = input.year || bookToUpdate.year;
        bookToUpdate.rating = input.rating || bookToUpdate.rating;
        return bookToUpdate;
      }
      return null;
    },
  },

  Subscription: {
    bookSub: {
      subscribe: () => pubsub.asyncIterator("bookSub"),
      resolve: (payload) => {
        return payload.addBook;
      },
    },
  },
};

// Create schema, which will be used separately by ApolloServer and
// the WebSocket server.
const schema = makeExecutableSchema({ typeDefs, resolvers });

// Create an Express app and HTTP server; we will attach the WebSocket
// server and the ApolloServer to this HTTP server.
const app = express();
const httpServer = createServer(app);

// Set up WebSocket server.
const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/graphql",
});
const serverCleanup = useServer({ schema }, wsServer);

// Set up ApolloServer.
const server = new ApolloServer({
  schema,
  plugins: [
    // Proper shutdown for the HTTP server.
    ApolloServerPluginDrainHttpServer({ httpServer }),

    // Proper shutdown for the WebSocket server.
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
});

await server.start();
app.use(
  "/graphql",
  cors<cors.CorsRequest>(),
  bodyParser.json(),
  expressMiddleware(server)
);

// Now that our HTTP server is fully set up, actually listen.
httpServer.listen(PORT, () => {
  console.log(`🚀 Query endpoint ready at http://localhost:${PORT}/graphql`);
  console.log(
    `🚀 Subscription endpoint ready at ws://localhost:${PORT}/graphql`
  );
});
