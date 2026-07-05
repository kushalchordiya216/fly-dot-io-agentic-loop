package main

import (
	"fmt"
	"net/http"
)

// Handler responds to an HTTP request.
func Handler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "World"
	}
	fmt.Fprintf(w, "Hello, %s!", name)
}

func main() {
	http.HandleFunc("/", Handler)
	fmt.Println("Server listening on :8080")
	http.ListenAndServe(":8080", nil)
}
