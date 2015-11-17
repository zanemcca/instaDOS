
## Usage
- docker build -t instados .
- docker run -e <OPTIONS> -t instados

Options are environment varibles
- RATE: The rate of requests in req/sec                           Default: 50
- TOTAL_USERS: The total number of users/processes to use         Default: 50
- RANDOM_TIMING: A boolean that turns random timing on and off    Default: true
- HOST_URL: The host that is to be queried against                Default: 'instanews.com'
- HOST_PORT: The host port for the query                          Default: '80' 
