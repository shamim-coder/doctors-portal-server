const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MiddleTire
const verifyJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).send({ message: "unauthorized" });
    }
    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: "forbidden" });
        }
        req.decoded = decoded;
        await next();
    });
};

// option to connect with SENDGRID
const emailSenderOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY,
    },
};

const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));

const sendAppointmentEmail = (booking) => {
    const { email, patientName, date, slot, treatmentName, doctor } = booking;

    const emailSender = {
        from: process.env.EMAIL_SENDER,
        to: email,
        subject: `Your appointment for ${treatmentName} is Confirm`,
        text: `Your appointment for ${treatmentName} is Confirm`,
        html: `
        <div>
            <h1>Hello ${patientName}</h1>
            <p>Congratulation! you have successfully booking your appointment for ${treatmentName} on ${date} at ${slot}</p>
            <p>Your doctor ${doctor} looking forward to see you on ${date} </p>

            <h4>Our Address:</h4>
            <address> CB-10, Muslim Modern School Road, Kachukhet Puran Bazar, Dhaka Cantonment, Dhaka-1206 </address>


        </div>`,
    };

    emailClient.sendMail(emailSender, function (err, info) {
        if (err) {
            console.log(err);
        } else {
            console.log("Message sent: " + info.response);
        }
    });
};

const sendPaymentEmail = (bookingInfo) => {
    const { email, patientName, date, slot, treatmentName, amount, transactionId } = bookingInfo;

    const emailSender = {
        from: process.env.EMAIL_SENDER,
        to: email,
        subject: `Your Payment for ${treatmentName} has been received`,
        text: `Your Payment for ${treatmentName} is Confirm`,
        html: `
        <div>
            <h2>Hello ${patientName}</h2>
            <p>Thank you for your payment, your appointment of ${treatmentName} on ${date} at ${slot} is confirmed by your payment.</p>
            
            <h4>You have paid $${amount}  for your appointment</h4>
            <h4>Your Transaction ID: ${transactionId}</h4>
            <br>
            <br>
            <h4>Our Address:</h4>
            <address> CB-10, Muslim Modern School Road, Kachukhet Puran Bazar, Dhaka Cantonment, Dhaka-1206 </address>


        </div>`,
    };

    emailClient.sendMail(emailSender, function (err, info) {
        if (err) {
            console.log(err);
        } else {
            console.log("Message sent: " + info.response);
        }
    });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bdn6hdg.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const run = async () => {
    try {
        await client.connect();
        const bookingCollection = client.db("doctors-portal").collection("booking");
        const serviceCollection = client.db("doctors-portal").collection("services");
        const navCollection = client.db("doctors-portal").collection("navItems");
        const userCollection = client.db("doctors-portal").collection("users");
        const paymentCollection = client.db("doctors-portal").collection("payments");

        // Nav Items API
        app.get("/navItems", async (req, res) => {
            const query = {};
            const cursor = navCollection.find(query);
            const navItems = await cursor.toArray();
            res.send(navItems);
        });

        //
        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price) * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
                // automatic_payment_methods: {
                //     enabled: true,
                // },
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // check admin role using api
        app.get("/admin/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;
            const decodedEmail = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: decodedEmail });
            const isAdmin = requesterAccount.role === "admin";
            res.send({ isAdmin });
        });

        // get All users
        app.get("/users", verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });

        // update user to admin
        app.put("/user/admin/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === "admin") {
                const filter = { email: email };
                const updateDoc = {
                    $set: { role: "admin" },
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
            } else {
                res.status(403).send({ message: "forbidden" });
            }
        });

        // User Update or Insert by PUT
        app.put("/user/:email", async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
            res.send({ result, token });
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
         * API Naming Convention.
         * app.get('/booking) // get all bookings in the collection.
         * app.get(/booking/:id) // get specific booking item.
         * app.post(/booking) // add a new booking
         * app.patch(/booking/:id) // update specific booking
         * app.delete(/booking/:id) // delete specific booking
         */

        app.get("/booking", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (decodedEmail === email) {
                const query = { email: email };
                const booking = await bookingCollection.find(query).sort({ _id: -1 }).toArray();
                return res.send(booking);
            } else {
                return res.status(403).send({ message: "forbidden" });
            }
        });

        app.get("/booking/:id", async (req, res) => {
            const { id } = req.params;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
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

            // sending confirmation email....
            sendAppointmentEmail(booking);

            return res.send({ success: true, result });
        });

        app.patch("/booking/:id", async (req, res) => {
            const { id } = req.params;
            const paymentInfo = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: paymentInfo.transactionId,
                },
            };

            const updateBooking = await bookingCollection.updateOne(filter, updatedDoc);
            const updatePayment = await paymentCollection.insertOne(paymentInfo);
            sendPaymentEmail(paymentInfo);
            res.send({ updateBooking, updatePayment });
        });
    } finally {
        // await client.close();
    }
};
run().catch(console.dir);

app.get("/", (req, res) => res.send("Hello from Doctor's Portal"));

app.listen(port, () => console.log(`Doctors Portal app listening on port ${port}!`));
