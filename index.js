const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bdn6hdg.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const run = async () => {
    try {
        await client.connect();
        const bookingCollection = client.db("doctors-portal").collection("booking");
        const serviceCollection = client.db("doctors-portal").collection("services");
        const navCollection = client.db("doctors-portal").collection("navItems");
        const userCollection = client.db("doctors-portal").collection("users");

        // Nav Items API
        app.get("/navItems", async (req, res) => {
            const query = {};
            const cursor = navCollection.find(query);
            const navItems = await cursor.toArray();
            res.send(navItems);
        });

        // User Update or Insert by PUT
        app.put("/user/:email", async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            console.log(email, user);
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        });

        app.get("/services", async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        });

        // get available services
        app.get("/available", async (req, res) => {
            const date = req.query.date || "Jul 6, 2022";

            // step-1: get all services
            const services = await serviceCollection.find().toArray();

            // step-2: get the booking of that day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            // step-3: for each service,
            services.forEach((service) => {
                // step-4: find bookings for that service by service name
                const serviceBooking = bookings.filter((booking) => booking.treatmentName === service.name);

                // step-5: select slots for the service bookings
                const booked = serviceBooking.map((booking) => booking.slot);

                // step-6: find available slots that are not in the booked slots
                const available = service.slots.filter((slot) => !booked.includes(slot.time));

                // step-7: set available service to the services
                service.available = available;
            });

            res.send(services);
        });

        /**
         * API Naming Convention
         * app.get('/booking) // get all bookings in the collection.
         * app.get(/booking/:id) // get specific booking item.
         * app.post(/booking) // add a new booking
         * app.patch(/booking/:id) // update specific booking
         * app.delete(/booking/:id) // delete specific booking
         */

        app.get("/booking", async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const booking = await bookingCollection.find(query).toArray();
            res.send(booking);
        });

        app.post("/booking", async (req, res) => {
            const booking = req.body;
            const query = { date: booking.date, treatmentName: booking.treatmentName, email: booking.email };
            const exists = await bookingCollection.findOne(query);

            if (exists) {
                return res.send({ success: false, existsData: exists });
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        }); //
    } finally {
        // await client.close();
    }
};
run().catch(console.dir);

app.get("/", (req, res) => res.send("Hello from Doctor's Portal"));

app.listen(port, () => console.log(`Doctors Portal app listening on port ${port}!`));
